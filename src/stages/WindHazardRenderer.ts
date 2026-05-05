import Phaser from 'phaser';
import {
  WindZoneHazard,
  createWindHazardFromStageHazard as createWindHazardFromStageHazardImpl,
} from '../entities/WindZoneHazard';
import type { StageLayout } from '../types';
import {
  COLLISION_CATEGORIES,
  COLLISION_MASKS,
} from '../engine/collisionCategories';
import { WIND_HAZARD_LABEL_PREFIX } from '../match';

/**
 * Re-export of the Phaser-free authoring → runtime bridge from
 * `entities/WindZoneHazard.ts`. Kept under the renderer barrel so
 * existing call sites that imported it from this module keep working
 * unchanged; the canonical implementation now lives next to the
 * entity so headless tests (under plain Node) can drive it without
 * pulling Phaser into their import graph.
 */
export const createWindHazardFromStageHazard =
  createWindHazardFromStageHazardImpl;

/**
 * `WindHazardRenderer` — AC 10102 Sub-AC 2.
 *
 * Sister of {@link LavaHazardRenderer}. Bridges three things that the
 * rest of the engine deliberately keeps separate:
 *
 *   1. **Authoring data** — `StageHazard` records (Phaser-free; JSON
 *      round-trippable through the M3 builder).
 *   2. **Runtime entity** — {@link WindZoneHazard} (Phaser-free; the
 *      deterministic frame-counter-driven oscillator that owns the
 *      gust's mutable state).
 *   3. **Phaser+Matter actor** — a Matter `isSensor` body and Phaser
 *      visuals (gust streamers + tint) that the gameplay scene
 *      renders and the {@link WindForceController} listens to.
 *
 * Why this lives in `stages/` (not `entities/` or `engine/`):
 *   - The renderer is the only place Phaser + Matter + WindZoneHazard
 *     converge. Co-located with `LavaHazardRenderer` so the two
 *     hazard families share one "turn StageHazard data into live
 *     scene actors" pattern.
 *
 * Determinism contract (mirrors LavaHazardRenderer):
 *   - The renderer **does not** advance the wind's frame counter on
 *     its own. The owning scene calls `entity.tick()` exactly once
 *     per fixed physics step, locking the gust clock to the
 *     simulation clock — which is what guarantees replay byte-
 *     equivalence.
 *   - `update()` is render-only: re-positions the Matter sensor body
 *     and the gust visual to match the entity's current state.
 *
 * Tunable timing parameters: every knob (`cycleFrames`, `phaseFrames`,
 * `forceX`, `forceY`, `activeThreshold`) flows from the StageHazard
 * authoring record through {@link createWindHazardFromStageHazard}
 * into the {@link WindZoneHazard} constructor.
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface WindVisualOptions {
  /** Stroke / fill colour while the gust is quiet (low-magnitude). */
  readonly inactiveColor?: number;
  /** Stroke / fill colour while the gust is active (high-magnitude). */
  readonly activeColor?: number;
  /** Outline colour drawn around the wind zone AABB. */
  readonly strokeColor?: number;
}

export interface WindRenderOptions extends WindVisualOptions {
  readonly viewportScale: number;
  readonly offsetX: number;
  readonly offsetY: number;
}

export interface RenderedWindHazard {
  readonly entity: WindZoneHazard;
  readonly body: MatterJS.BodyType;
  readonly visual: Phaser.GameObjects.Rectangle;
  readonly scale: number;
  update(): void;
  destroy(): void;
}

export const DEFAULT_WIND_VISUAL_COLORS = {
  inactive: 0x4a8aa0,
  active: 0x9ce0ff,
  stroke: 0x0a1a25,
} as const;

// ---------------------------------------------------------------------------
// Construction helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/**
 * Spawn the Matter sensor body + a thin Phaser visual for a single
 * wind zone, and return a {@link RenderedWindHazard} handle.
 *
 * Body shape: an `isStatic + isSensor` rectangle filtered through the
 * shared `HAZARD` collision category — same family as lava bodies, so
 * the existing CHARACTER mask sees both kinds of hazard without any
 * change. The body's `label` follows the convention
 * `"hazard.wind.<id>"` so {@link WindForceController} can apply its
 * idiomatic `WIND_HAZARD_LABEL_PREFIX` startsWith check.
 *
 * Visuals: a single translucent `Rectangle` whose colour shifts with
 * gust phase so the player can read where the wind is and which
 * direction it's currently blowing without any HUD clutter.
 */
export function renderWindHazard(
  scene: Phaser.Scene,
  hazard: WindZoneHazard,
  options: WindRenderOptions,
): RenderedWindHazard {
  const { viewportScale, offsetX, offsetY } = options;
  if (!(viewportScale > 0)) {
    throw new Error(
      `renderWindHazard: viewportScale must be > 0 (got ${viewportScale}).`,
    );
  }
  const inactiveColor =
    options.inactiveColor ?? DEFAULT_WIND_VISUAL_COLORS.inactive;
  const activeColor =
    options.activeColor ?? DEFAULT_WIND_VISUAL_COLORS.active;
  const strokeColor =
    options.strokeColor ?? DEFAULT_WIND_VISUAL_COLORS.stroke;

  const id = hazard.getId();
  const bounds = hazard.getBounds();
  const label = `${WIND_HAZARD_LABEL_PREFIX}${id}`;

  const initCenterX = offsetX + bounds.x * viewportScale;
  const initCenterY = offsetY + bounds.y * viewportScale;
  const initW = bounds.width * viewportScale;
  const initH = bounds.height * viewportScale;

  const body = scene.matter.add.rectangle(
    initCenterX,
    initCenterY,
    initW,
    initH,
    {
      isStatic: true,
      isSensor: true,
      label,
      collisionFilter: {
        category: COLLISION_CATEGORIES.HAZARD,
        mask: COLLISION_MASKS.HAZARD,
        group: 0,
      },
      plugin: { hazardKind: 'wind', hazardId: id },
    },
  );

  // Visual: a translucent rectangle. The fill colour interpolates
  // between inactiveColor (quiet) and activeColor (gust at apex) via
  // alpha — gives the player a visible cue of when the wind is on
  // without obscuring the action.
  // procedural fallback — wind zone rendered as a flat-colour
  // `Phaser.GameObjects.Rectangle` because no gust streamer sprite/
  // particle texture is registered in `assets/manifest.ts` yet.
  // Replace by registering a streamer atlas and swapping this for a
  // particle emitter or animated TileSprite.
  const visual = scene.add
    .rectangle(initCenterX, initCenterY, initW, initH, inactiveColor, 0.18)
    .setStrokeStyle(2, strokeColor, 0.4)
    .setDepth(-1);

  let destroyed = false;

  const update = (): void => {
    if (destroyed) return;
    const liveBounds = hazard.getBounds();
    const centerX = offsetX + liveBounds.x * viewportScale;
    const centerY = offsetY + liveBounds.y * viewportScale;
    const widthView = liveBounds.width * viewportScale;
    const heightView = liveBounds.height * viewportScale;

    // The body's geometry is immutable in `WindZoneHazard` — only the
    // force vector changes per frame. So we don't reposition vertices;
    // we just keep the visual in sync (in case the scene resizes).
    type RectBody = MatterJS.BodyType & {
      setPosition?: (pos: { x: number; y: number }) => void;
    };
    const rectBody = body as RectBody;
    if (typeof rectBody.setPosition === 'function') {
      rectBody.setPosition({ x: centerX, y: centerY });
    } else {
      rectBody.position.x = centerX;
      rectBody.position.y = centerY;
    }

    // Toggle the body's mask off while the wind is quiet so the
    // broadphase doesn't churn through `collisionstart`/`collisionend`
    // every cycle — the controller is gated on `isActive()` already,
    // but masking the body keeps Matter quiet too.
    if (rectBody.collisionFilter) {
      rectBody.collisionFilter.mask = hazard.isActive()
        ? COLLISION_MASKS.HAZARD
        : 0;
    }

    visual.setPosition(centerX, centerY);
    visual.setSize(widthView, heightView);
    visual.setFillStyle(
      hazard.isActive() ? activeColor : inactiveColor,
      hazard.isActive() ? 0.32 : 0.16,
    );
  };

  update();

  const destroy = (): void => {
    if (destroyed) return;
    destroyed = true;
    scene.matter?.world?.remove(body);
    visual.destroy();
  };

  return {
    entity: hazard,
    body,
    visual,
    scale: viewportScale,
    update,
    destroy,
  };
}

// ---------------------------------------------------------------------------
// Stage-level convenience: render every wind hazard on a layout
// ---------------------------------------------------------------------------

export interface WindHazardsRenderResult {
  readonly hazards: ReadonlyArray<RenderedWindHazard>;
  update(): void;
  destroy(): void;
}

/**
 * Walk a `StageLayout`'s `hazards` array, instantiate a `WindZoneHazard`
 * entity + renderer for every `'wind'`-typed entry, and return a
 * grouped result the gameplay scene can drive in one call. Non-wind
 * hazard types are skipped — they get their own renderer factories.
 *
 * The viewport transform parameters mirror those used by
 * {@link renderStage}; pass `RenderedStage.scale` and the same
 * design-centred offsets so the wind zones align with the platform
 * geometry on any viewport size.
 */
export function renderWindHazards(
  scene: Phaser.Scene,
  layout: StageLayout,
  transform: {
    readonly viewportScale: number;
    readonly offsetX: number;
    readonly offsetY: number;
  },
  visualOverrides: WindVisualOptions = {},
): WindHazardsRenderResult {
  const handles: RenderedWindHazard[] = [];
  for (const stageHazard of layout.hazards) {
    if (stageHazard.type !== 'wind') continue;
    const entity = createWindHazardFromStageHazard(stageHazard);
    const handle = renderWindHazard(scene, entity, {
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
