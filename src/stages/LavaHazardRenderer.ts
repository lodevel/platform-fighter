import Phaser from 'phaser';
import { LavaHazard, LAVA_DEFAULTS } from '../entities/LavaHazard';
import type { StageHazard, StageLayout } from '../types';
import {
  COLLISION_CATEGORIES,
  COLLISION_MASKS,
} from '../engine/collisionCategories';
import { LAVA_HAZARD_LABEL_PREFIX } from '../match';
import { STAGE_DESIGN_HEIGHT, STAGE_DESIGN_WIDTH } from './stageDefinitions';

/**
 * `LavaHazardRenderer` — Sub-AC 3 of AC 9.
 *
 * Bridges three things that the rest of the engine deliberately keeps
 * separate:
 *
 *   1. **Authoring data** — `StageHazard` records on a `StageLayout`
 *      (Phaser-free; serialisable to JSON for the M3 stage builder
 *      and the M4 replay header).
 *   2. **Runtime entity** — `LavaHazard` (Phaser-free; the
 *      deterministic frame-counter-driven oscillator that owns the
 *      lava's mutable state). See `entities/LavaHazard.ts`.
 *   3. **Phaser+Matter actor** — a Matter `isSensor` body and a pair
 *      of Phaser visuals (lava fill + molten top edge) that the
 *      gameplay scene actually renders and the
 *      `LavaCollisionWatcher` listens to.
 *
 * Why this lives in `stages/` (not `entities/` or `engine/`):
 *   - The renderer is the **only** place Phaser + Matter + LavaHazard
 *     converge. Putting it next to `StageRenderer.ts` keeps "things
 *     that turn StageLayout → live scene actors" co-located so the
 *     M3 stage-builder preview can re-use the same factories without
 *     an extra cross-module hop.
 *   - The runtime entity stays Phaser-free (so `LavaHazard.test.ts`
 *     keeps running under plain Node), and the StageHazard authoring
 *     record stays JSON-friendly (so the builder's `localStorage`
 *     export still round-trips).
 *
 * Determinism contract:
 *   - The renderer **does not** advance the lava's frame counter on
 *     its own. The owning scene calls `entity.tick()` exactly once
 *     per fixed physics step (alongside `physicsEngine.advance`) so
 *     the lava clock stays locked to the simulation clock — this is
 *     what guarantees replay byte-equivalence.
 *   - `update()` is render-only: it reads the entity's current
 *     `getBounds()` / `isActive()` and re-positions the Matter sensor
 *     body + Phaser visuals to match. The body is moved via
 *     `Body.setPosition` + `Body.setVertices` (or recreated each
 *     update) — but because the entity exposes the same bounds for
 *     identical frame counters across runs, two replays produce
 *     pixel-identical visuals.
 *
 * Tunable timing parameters (Sub-AC 3 acceptance contract):
 *   - All three timing knobs (`cycleFrames`, `phaseFrames`,
 *     `activeThreshold`) flow from the `StageHazard` authoring
 *     record into the `LavaHazard` constructor, and are exposed at
 *     the renderer level via `RenderedLavaHazard.entity` so a debug
 *     overlay or live-tuning tool can read them at runtime. The
 *     stage definition (`createLavaStage` in `stageDefinitions.ts`)
 *     surfaces them as factory options so the canonical stage and
 *     custom variants share one tuning surface.
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Visual styling overrides for a single lava hazard. All colours are
 * Phaser/CSS hex integers (0xRRGGBB). The defaults below are tuned
 * for the existing dark-blue stage palette.
 */
export interface LavaVisualOptions {
  /** Fill colour while the lava is BELOW its activeThreshold (warning amber). */
  readonly inactiveColor?: number;
  /** Fill colour while the lava is ACTIVE / lethal (lethal red-orange). */
  readonly activeColor?: number;
  /** Top-edge "molten" highlight colour (bright yellow by default). */
  readonly glowColor?: number;
  /** Stroke colour drawn around the lava body. */
  readonly strokeColor?: number;
}

/**
 * Per-instance render options handed to {@link renderLavaHazard}. The
 * scale/offset numbers come from the stage's design→viewport
 * transform — pass the values from {@link RenderedStage.scale} (and
 * the stage's centred offset) so the lava aligns with the platform
 * geometry on any viewport size.
 */
export interface LavaRenderOptions extends LavaVisualOptions {
  /** Uniform design→viewport scale factor (typically `RenderedStage.scale`). */
  readonly viewportScale: number;
  /** Horizontal viewport offset added to scaled X coords. */
  readonly offsetX: number;
  /** Vertical viewport offset added to scaled Y coords. */
  readonly offsetY: number;
}

/**
 * Live handle to a single lava hazard instance — the entity, its
 * Matter sensor body, and the Phaser visuals that render it. Returned
 * from {@link renderLavaHazard}.
 *
 * Lifecycle expectations:
 *   - Owning scene calls `entity.tick()` once per fixed physics step
 *     (NOT here — keeps determinism on the scene's clock).
 *   - Owning scene calls `update()` once per render frame to re-sync
 *     the body position / visual fill to the entity's current state.
 *   - Owning scene calls `destroy()` on shutdown to release Matter
 *     bodies + Phaser GameObjects.
 */
export interface RenderedLavaHazard {
  /** The deterministic runtime entity. */
  readonly entity: LavaHazard;
  /** Matter sensor body — registered with `LavaCollisionWatcher`. */
  readonly body: MatterJS.BodyType;
  /** The lava-fill rectangle (height changes each frame). */
  readonly fill: Phaser.GameObjects.Rectangle;
  /** Thin "molten" top-edge highlight pinned to the lava surface. */
  readonly glow: Phaser.GameObjects.Rectangle;
  /** Resolved viewport-space scale used at construction. */
  readonly scale: number;
  /** Re-sync body position + visuals to the entity's current frame. */
  update(): void;
  /** Tear down body + visuals. Idempotent. */
  destroy(): void;
}

/**
 * Default fill / stroke colours. Inactive lava reads as warm amber
 * "warning"; active lava reads as urgent red-orange. The bright
 * yellow glow at the top edge stays visible against both.
 */
export const DEFAULT_LAVA_VISUAL_COLORS = {
  inactive: 0xc24a1a,
  active: 0xff5520,
  glow: 0xffe070,
  stroke: 0x1a0a05,
} as const;

/**
 * Thickness (in design pixels) of the "molten" top-edge highlight
 * pinned to the lava surface. Drawn separately from the main fill so
 * it stays a constant 8 px high regardless of how tall the body is —
 * a fading lava body still has a crisp lip at its surface.
 */
const GLOW_THICKNESS_DESIGN_PX = 8;

/**
 * Minimum body height (in design pixels) the Matter sensor will use,
 * even when the entity reports a height near zero. Matter requires a
 * non-degenerate body — anything below ~0.1 px risks NaN broadphase
 * normals — so we floor at 1 px and toggle `isSensor`'s collision
 * category off when the lava is fully receded (handled in `update()`).
 */
const MIN_SENSOR_HEIGHT_DESIGN_PX = 1;

// ---------------------------------------------------------------------------
// Construction helpers
// ---------------------------------------------------------------------------

/**
 * Convert a `StageHazard` authoring record (lava type) into the
 * runtime `LavaHazard` entity. Pulls all tunable timing parameters
 * (`cycleFrames`, `phaseFrames`, `damagePerTick`, `activeThreshold`,
 * `minHeight`) off the record with documented fallbacks to
 * {@link LAVA_DEFAULTS} so a JSON-only stage authored without those
 * fields still produces a functional hazard.
 *
 * Throws on a non-lava `StageHazard.type` so a programmer mistake
 * surfaces as a clear error rather than a silent no-op renderer.
 */
export function createLavaHazardFromStageHazard(
  stageHazard: StageHazard,
): LavaHazard {
  if (stageHazard.type !== 'lava') {
    throw new Error(
      `createLavaHazardFromStageHazard: hazard.type must be 'lava', got '${stageHazard.type}'.`,
    );
  }
  return new LavaHazard({
    id: stageHazard.id ?? 'lava',
    x: stageHazard.x,
    baseY: stageHazard.y,
    width: stageHazard.width,
    maxHeight: stageHazard.height,
    minHeight: stageHazard.minHeight ?? LAVA_DEFAULTS.minHeight,
    cycleFrames: stageHazard.cycleFrames ?? LAVA_DEFAULTS.cycleFrames,
    phaseFrames: stageHazard.phaseFrames ?? 0,
    damagePerTick: stageHazard.damagePerTick ?? LAVA_DEFAULTS.damagePerTick,
    activeThreshold:
      stageHazard.activeThreshold ?? LAVA_DEFAULTS.activeThreshold,
  });
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/**
 * Spawn the Matter sensor body + Phaser visuals for a single lava
 * hazard and return a `RenderedLavaHazard` handle.
 *
 * Body shape: an `isStatic + isSensor` rectangle filtered through the
 * shared {@link COLLISION_CATEGORIES}.HAZARD category. The body's
 * `label` follows the convention `"hazard.lava.<id>"` so Matter's
 * debug overlay reads cleanly and {@link LavaCollisionWatcher} can
 * apply its idiomatic `LAVA_HAZARD_LABEL_PREFIX` startsWith check.
 *
 * Visuals: a single `Rectangle` for the lava body fill plus a thin
 * `Rectangle` "molten lip" at the top edge. Both are tinted from
 * {@link DEFAULT_LAVA_VISUAL_COLORS} (amber while dormant, red-
 * orange while active) and resized each `update()` to match the
 * entity's `getBounds()` × the supplied viewport scale.
 */
export function renderLavaHazard(
  scene: Phaser.Scene,
  hazard: LavaHazard,
  options: LavaRenderOptions,
): RenderedLavaHazard {
  const { viewportScale, offsetX, offsetY } = options;
  if (!(viewportScale > 0)) {
    throw new Error(
      `renderLavaHazard: viewportScale must be > 0 (got ${viewportScale}).`,
    );
  }
  const inactiveColor =
    options.inactiveColor ?? DEFAULT_LAVA_VISUAL_COLORS.inactive;
  const activeColor =
    options.activeColor ?? DEFAULT_LAVA_VISUAL_COLORS.active;
  const glowColor = options.glowColor ?? DEFAULT_LAVA_VISUAL_COLORS.glow;
  const strokeColor = options.strokeColor ?? DEFAULT_LAVA_VISUAL_COLORS.stroke;

  const id = hazard.getId();
  const designBaseY = hazard.getBaseY();
  const designWidth = hazard.getWidth();
  const label = `${LAVA_HAZARD_LABEL_PREFIX}${id}`;

  // ---- Initial bounds at the entity's current frame --------------------
  const bounds = hazard.getBounds();
  const initHeightDesign = Math.max(
    MIN_SENSOR_HEIGHT_DESIGN_PX,
    bounds.height,
  );
  const initCenterX = offsetX + bounds.x * viewportScale;
  const initCenterY =
    offsetY + (designBaseY - initHeightDesign / 2) * viewportScale;
  const initW = designWidth * viewportScale;
  const initH = initHeightDesign * viewportScale;

  // ---- Matter sensor body ----------------------------------------------
  // We want overlap *events* (the watcher gates damage on
  // `isActive()`), not physical collision. Hence isSensor=true.
  // The HAZARD category + HAZARD mask matches CHARACTER and
  // PROJECTILE so a fighter walking onto the lava emits the
  // collisionstart/collisionend pair the watcher consumes.
  const body = scene.matter.add.rectangle(initCenterX, initCenterY, initW, initH, {
    isStatic: true,
    isSensor: true,
    label,
    collisionFilter: {
      category: COLLISION_CATEGORIES.HAZARD,
      mask: COLLISION_MASKS.HAZARD,
      group: 0,
    },
    plugin: { hazardKind: 'lava', hazardId: id },
  });

  // ---- Visual fill rectangle ------------------------------------------
  // procedural fallback — lava body rendered as a flat-colour
  // `Phaser.GameObjects.Rectangle` (amber → red-orange tint switch on
  // active/inactive). No CC0 lava sprite/atlas is wired into
  // `assets/manifest.ts` yet; replace by registering a lava texture and
  // swapping this rectangle for a tiled `TileSprite`/animated `Sprite`.
  const fill = scene.add
    .rectangle(initCenterX, initCenterY, initW, initH, inactiveColor, 0.85)
    .setStrokeStyle(2, strokeColor)
    .setDepth(-1); // Behind fighters but above the stage backdrop.

  // ---- Molten top-edge highlight --------------------------------------
  // Pinned to the lava surface (top edge). Re-positioned each
  // `update()` so it always hugs the current surface Y. The thin
  // strip stays a constant *design* height (8 px) regardless of how
  // tall the lava body is — a near-empty pool still has a crisp lip
  // so the player can tell where the surface is.
  // procedural fallback — bright-yellow surface strip painted as a
  // separate flat-colour rectangle (no sprite frame).
  const glowH = GLOW_THICKNESS_DESIGN_PX * viewportScale;
  const surfaceCenterY =
    offsetY +
    (designBaseY - initHeightDesign + GLOW_THICKNESS_DESIGN_PX / 2) *
      viewportScale;
  const glow = scene.add
    .rectangle(initCenterX, surfaceCenterY, initW, glowH, glowColor, 0.65)
    .setDepth(0);

  let destroyed = false;

  /**
   * Re-sync body + visuals to the entity's current frame. Called from
   * the owning scene's render hook (not from inside the entity tick)
   * so the visual lerp can read interpolated state if needed in a
   * later milestone.
   *
   * Implementation notes:
   *   - We update the body's position via `Body.setPosition` to keep
   *     the Matter broadphase correct.
   *   - The body's *vertices* are scaled via `Body.scale`. Since
   *     Matter scales relative to the body's current dimensions, we
   *     compute and store the previous height and divide-current-by-
   *     previous to get the scale factor. Tracking previous height
   *     locally avoids a Matter API hop per call.
   *   - When the lava recedes to ~zero height, we toggle the body's
   *     `collisionFilter.mask` to 0 so `LavaCollisionWatcher` doesn't
   *     get a flurry of `collisionstart`/`collisionend` events at
   *     trough. The watcher itself is also gated on `isActive()`,
   *     but masking the body keeps the broadphase quiet too.
   */
  let prevHeightDesign = initHeightDesign;
  const update = (): void => {
    if (destroyed) return;
    const liveBounds = hazard.getBounds();
    const heightDesign = Math.max(
      MIN_SENSOR_HEIGHT_DESIGN_PX,
      liveBounds.height,
    );
    const centerX = offsetX + liveBounds.x * viewportScale;
    const centerY = offsetY + (designBaseY - heightDesign / 2) * viewportScale;
    const widthView = designWidth * viewportScale;
    const heightView = heightDesign * viewportScale;

    // Body: re-position. We *recreate vertices* via setVertices for
    // shape changes — Matter's `Body.scale` accumulates floating-point
    // error across many calls and would drift the body width over
    // time. Re-vertexing is cheap for a 4-vertex AABB.
    type RectBody = MatterJS.BodyType & {
      setPosition?: (pos: { x: number; y: number }) => void;
      vertices?: Array<{ x: number; y: number }>;
    };
    const rectBody = body as RectBody;
    if (typeof rectBody.setPosition === 'function') {
      rectBody.setPosition({ x: centerX, y: centerY });
    } else {
      // Fallback for environments where Matter's static-body API
      // doesn't expose `setPosition` on the typed body — write the
      // position field directly. Both paths produce identical
      // broadphase behaviour for static sensor bodies.
      rectBody.position.x = centerX;
      rectBody.position.y = centerY;
    }
    // Resize via direct vertex assignment so floating-point drift
    // can't accumulate across thousands of frames.
    if (Array.isArray(rectBody.vertices) && rectBody.vertices.length === 4) {
      const halfW = widthView / 2;
      const halfH = heightView / 2;
      rectBody.vertices[0]!.x = centerX - halfW;
      rectBody.vertices[0]!.y = centerY - halfH;
      rectBody.vertices[1]!.x = centerX + halfW;
      rectBody.vertices[1]!.y = centerY - halfH;
      rectBody.vertices[2]!.x = centerX + halfW;
      rectBody.vertices[2]!.y = centerY + halfH;
      rectBody.vertices[3]!.x = centerX - halfW;
      rectBody.vertices[3]!.y = centerY + halfH;
    }

    // Active/inactive mask gate — see comment block above.
    if (rectBody.collisionFilter) {
      rectBody.collisionFilter.mask = hazard.isActive()
        ? COLLISION_MASKS.HAZARD
        : 0;
    }

    // Fill rectangle: re-position + re-size + re-tint.
    fill.setPosition(centerX, centerY);
    fill.setSize(widthView, heightView);
    fill.setFillStyle(
      hazard.isActive() ? activeColor : inactiveColor,
      0.85,
    );

    // Glow: pin to the *top* of the lava body — i.e. the surface.
    const surfaceCenter =
      offsetY +
      (designBaseY - heightDesign + GLOW_THICKNESS_DESIGN_PX / 2) *
        viewportScale;
    glow.setPosition(centerX, surfaceCenter);
    glow.setSize(widthView, GLOW_THICKNESS_DESIGN_PX * viewportScale);
    // Hide the molten lip when the pool is fully receded — there's
    // no surface to highlight, and a stray pixel band at baseY would
    // read as a permanent line through the floor.
    const visible = heightDesign > MIN_SENSOR_HEIGHT_DESIGN_PX + 0.01;
    glow.setVisible(visible);

    prevHeightDesign = heightDesign;
  };

  // Run an initial update so the active-state mask gate is applied
  // before the first physics step (rather than waiting until the
  // first render hook tick after the gameplay loop starts).
  update();
  // Mark prevHeightDesign-as-set linter-quiet (used inside `update`).
  void prevHeightDesign;

  const destroy = (): void => {
    if (destroyed) return;
    destroyed = true;
    scene.matter?.world?.remove(body);
    fill.destroy();
    glow.destroy();
  };

  return {
    entity: hazard,
    body,
    fill,
    glow,
    scale: viewportScale,
    update,
    destroy,
  };
}

// ---------------------------------------------------------------------------
// Stage-level convenience: render every lava hazard on a layout
// ---------------------------------------------------------------------------

export interface LavaHazardsRenderResult {
  /** One handle per lava hazard found on the layout, in layout order. */
  readonly hazards: ReadonlyArray<RenderedLavaHazard>;
  /** `update()` every handle in one call — mirrors `RenderedStage.destroy`. */
  update(): void;
  /** `destroy()` every handle. Idempotent. */
  destroy(): void;
}

/**
 * Walk a `StageLayout`'s `hazards` array, instantiate a `LavaHazard`
 * entity + renderer for every `'lava'`-typed entry, and return a
 * grouped result the gameplay scene can drive in one call. Non-lava
 * hazard types (wind / spikes / etc.) are skipped — they will get
 * their own renderer factories in later sub-ACs.
 *
 * The viewport transform parameters mirror those used by
 * {@link renderStage}; pass `RenderedStage.scale` and the same
 * design-centred offsets so the hazards align with the platform
 * geometry on any viewport size.
 */
export function renderLavaHazards(
  scene: Phaser.Scene,
  layout: StageLayout,
  transform: {
    readonly viewportScale: number;
    readonly offsetX: number;
    readonly offsetY: number;
  },
  visualOverrides: LavaVisualOptions = {},
): LavaHazardsRenderResult {
  const handles: RenderedLavaHazard[] = [];
  for (const stageHazard of layout.hazards) {
    if (stageHazard.type !== 'lava') continue;
    const entity = createLavaHazardFromStageHazard(stageHazard);
    const handle = renderLavaHazard(scene, entity, {
      viewportScale: transform.viewportScale,
      offsetX: transform.offsetX,
      offsetY: transform.offsetY,
      ...visualOverrides,
    });
    handles.push(handle);
  }

  let destroyed = false;
  return {
    hazards: handles,
    update(): void {
      if (destroyed) return;
      for (const h of handles) h.update();
    },
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      for (const h of handles) h.destroy();
    },
  };
}

/**
 * Compute the canonical design→viewport transform for a layout
 * given a viewport size. Mirrors the same math `StageRenderer`
 * applies internally, so callers can hand the exact same
 * `(viewportScale, offsetX, offsetY)` triple to both
 * {@link renderStage} and {@link renderLavaHazards} without
 * duplicating the formula at every call site.
 */
export function computeStageViewportTransform(viewportSize: {
  readonly width: number;
  readonly height: number;
}): {
  readonly viewportScale: number;
  readonly offsetX: number;
  readonly offsetY: number;
} {
  const scale = Math.min(
    viewportSize.width / STAGE_DESIGN_WIDTH,
    viewportSize.height / STAGE_DESIGN_HEIGHT,
  );
  return {
    viewportScale: scale,
    offsetX: (viewportSize.width - STAGE_DESIGN_WIDTH * scale) / 2,
    offsetY: (viewportSize.height - STAGE_DESIGN_HEIGHT * scale) / 2,
  };
}
