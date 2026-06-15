import Phaser from 'phaser';
import type { StageLayout } from '../types';
import {
  BACKGROUND_AMBIENT_DEPTH,
  BACKGROUND_GRADIENT_DEPTH,
  BACKGROUND_TEXTURE_TILE_SIZE,
  DEFAULT_TEXTURE_TILE_SCALE,
  backgroundLayerDepth,
  buildProceduralLayerPolygons,
  computeAmbientPulseAlpha,
  getBackgroundTheme,
  type ParallaxLayerSpec,
  type StageBackgroundTheme,
} from './backgroundThemes';

/**
 * `StageBackgroundRenderer` — the Phaser-touching painter for the
 * themed parallax backgrounds declared in `backgroundThemes.ts`.
 *
 * Third member of the "turn StageLayout data into live scene actors"
 * family (after `StageRenderer` and the hazard renderers), and the
 * module that finally wires the stage *backdrop* — until now every
 * stage rendered against the scene's flat `#13131f` clear colour.
 *
 * What it paints, back to front (all depths < 0, i.e. behind the
 * platform rectangles that render at Phaser's default depth 0):
 *
 *   1. **Gradient** (depth −60) — full-viewport vertical gradient
 *      drawn once with `Graphics.fillGradientStyle`.
 *   2. **Parallax layers** (depths −50 … −31) — one game object per
 *      `ParallaxLayerSpec`. When the spec names a `textureKey` that is
 *      present in the scene's texture cache, the layer is a
 *      `TileSprite` band (the M1 Kenney tiles repeat horizontally);
 *      otherwise the procedural silhouette polygons are filled into a
 *      `Graphics` object — so the backdrop is atmospheric even when no
 *      art ever loaded.
 *   3. **Ambient accent** (depth −30) — a low-alpha colour wash whose
 *      opacity breathes on the theme's pulse spec (lava glow, haze).
 *
 * Determinism contract:
 *   - Nothing here reads the wall clock or `Math.random()`. The
 *     procedural scatter comes from the theme's fixed LCG seeds, and
 *     the ambient pulse only advances when the owning scene calls
 *     {@link RenderedStageBackground.tick} with its fixed-step frame
 *     counter — mirroring how `LavaHazard.tick()` is scene-driven.
 *   - Parallax is render-only state: the owning scene forwards its
 *     camera scroll to {@link RenderedStageBackground.updateParallax}
 *     once per render frame. Layer offset = `-scroll * parallaxFactor`,
 *     so far layers (small factors) drift slower than near ones.
 *
 * Every created game object has `scrollFactor 0` — the background is
 * pinned to the viewport and ONLY moves through `updateParallax`,
 * which keeps the parallax math independent of whatever zoom/scroll
 * the dynamic match camera is doing.
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Viewport dimensions the background should fill. Usually the scene's
 * `scale.gameSize`; accepted as a parameter so the M3 stage-builder
 * preview (which renders into a sub-rect) can reuse the painter.
 */
export interface StageBackgroundViewport {
  readonly width: number;
  readonly height: number;
}

/** One live parallax layer — spec plus the game object that renders it. */
export interface RenderedBackgroundLayer {
  /** The authored spec this layer was built from. */
  readonly spec: ParallaxLayerSpec;
  /** Which render path was taken (texture band vs procedural fill). */
  readonly kind: 'texture' | 'procedural';
  /** The Phaser object — `TileSprite` for `'texture'`, `Graphics` otherwise. */
  readonly gameObject: Phaser.GameObjects.TileSprite | Phaser.GameObjects.Graphics;
  /** Authored resting position, before any parallax offset. */
  readonly baseX: number;
  readonly baseY: number;
}

/**
 * Live handle to a rendered stage background. Lifecycle expectations
 * (mirrors the hazard renderer contract):
 *
 *   - Owning scene calls {@link updateParallax} once per render frame
 *     with the camera scroll.
 *   - Owning scene calls {@link tick} once per fixed simulation step
 *     with its frame counter (drives the ambient glow pulse).
 *   - Owning scene calls {@link destroy} on shutdown. Idempotent.
 */
export interface RenderedStageBackground {
  /** The resolved theme (after midnight fallback for unknown ids). */
  readonly theme: StageBackgroundTheme;
  /** Full-viewport gradient graphics (depth −60). */
  readonly gradient: Phaser.GameObjects.Graphics;
  /** Ambient accent wash graphics (depth −30); alpha driven by `tick`. */
  readonly ambient: Phaser.GameObjects.Graphics;
  /** Parallax layers, back (index 0) to front. */
  readonly layers: ReadonlyArray<RenderedBackgroundLayer>;
  /**
   * Apply the camera scroll to every parallax layer. Procedural
   * layers move their game object by `-scroll * factor`; texture
   * bands scroll their tile pattern by the same screen-space amount
   * (divided by the tile scale, since `tilePosition` is measured in
   * texture pixels) and shift vertically with the object.
   */
  updateParallax(scrollX: number, scrollY: number): void;
  /**
   * Advance the ambient accent pulse to `frame`. Pure function of the
   * frame counter — calling twice with the same frame is a no-op, and
   * two clients at the same frame show identical glow.
   */
  tick(frame: number): void;
  /** Tear down every created game object. Idempotent. */
  destroy(): void;
}

// ---------------------------------------------------------------------------
// Painter
// ---------------------------------------------------------------------------

/**
 * Paint the themed background for `layout` into `scene`. Resolves
 * `layout.backgroundTheme` against the theme registry (falling back
 * to `'midnight'` for missing / unknown ids) and returns a live
 * handle the owning scene drives and destroys.
 *
 * @param scene    The active Phaser scene (Match, builder preview, …).
 * @param layout   Stage layout whose `backgroundTheme` selects the theme.
 * @param viewport Viewport to fill; defaults to `scene.scale.gameSize`.
 */
export function renderStageBackground(
  scene: Phaser.Scene,
  layout: StageLayout,
  viewport?: StageBackgroundViewport,
): RenderedStageBackground {
  const vp: StageBackgroundViewport = viewport ?? scene.scale.gameSize;
  const theme = getBackgroundTheme(layout.backgroundTheme);

  // ---- 1. Gradient ------------------------------------------------------
  // Single fill, never repainted — the gradient doesn't parallax or
  // animate, it just replaces the flat clear colour.
  const gradient = scene.add.graphics();
  gradient.setDepth(BACKGROUND_GRADIENT_DEPTH);
  gradient.setScrollFactor(0);
  gradient.fillGradientStyle(
    theme.gradientTop,
    theme.gradientTop,
    theme.gradientBottom,
    theme.gradientBottom,
    1,
  );
  gradient.fillRect(0, 0, vp.width, vp.height);

  // ---- 2. Parallax layers (back to front) -------------------------------
  const layers: RenderedBackgroundLayer[] = [];
  for (let i = 0; i < theme.layers.length; i += 1) {
    const spec = theme.layers[i]!;
    const depth = backgroundLayerDepth(i);

    const hasTexture =
      spec.textureKey !== undefined && scene.textures.exists(spec.textureKey);

    if (hasTexture) {
      // Texture band: one horizontal strip of the 24×24 Kenney tile,
      // upscaled so the pixel art reads at viewport size. Exactly one
      // tile row tall — the source tiles are horizontally seamless but
      // NOT vertically, so a taller band would show seams.
      const tileScale = spec.textureTileScale ?? DEFAULT_TEXTURE_TILE_SCALE;
      const bandHeight = BACKGROUND_TEXTURE_TILE_SIZE * tileScale;
      const baseX = vp.width / 2;
      const baseY = vp.height * (spec.textureYFraction ?? 0.5);

      const band = scene.add.tileSprite(
        baseX,
        baseY,
        vp.width,
        bandHeight,
        spec.textureKey!,
      );
      band.setDepth(depth);
      band.setScrollFactor(0);
      band.setAlpha(spec.alpha);
      band.setTileScale(tileScale, tileScale);
      if (spec.tint !== undefined) {
        band.setTint(spec.tint);
      }

      layers.push({ spec, kind: 'texture', gameObject: band, baseX, baseY });
    } else {
      // Procedural fallback: silhouette polygons from the pure module.
      // Generated with horizontal overscan, so sliding the whole
      // Graphics object for parallax never exposes a bare edge.
      const g = scene.add.graphics();
      g.setDepth(depth);
      g.setScrollFactor(0);
      g.setAlpha(spec.alpha);
      g.fillStyle(spec.procedural.color, 1);
      const polygons = buildProceduralLayerPolygons(
        spec.procedural,
        vp.width,
        vp.height,
      );
      for (const polygon of polygons) {
        g.fillPoints(
          polygon.points as Phaser.Types.Math.Vector2Like[],
          true,
        );
      }

      layers.push({ spec, kind: 'procedural', gameObject: g, baseX: 0, baseY: 0 });
    }
  }

  // ---- 3. Ambient accent wash -------------------------------------------
  // A full-viewport rect in the theme's accent colour. The Graphics
  // object's own alpha is the animated knob — `tick()` re-derives it
  // from the frame counter, so the fill itself is painted exactly once.
  const ambient = scene.add.graphics();
  ambient.setDepth(BACKGROUND_AMBIENT_DEPTH);
  ambient.setScrollFactor(0);
  ambient.fillStyle(theme.ambientAccent, 1);
  ambient.fillRect(0, 0, vp.width, vp.height);
  ambient.setAlpha(computeAmbientPulseAlpha(theme.ambientPulse, 0));

  // ---- Handle -------------------------------------------------------------
  let destroyed = false;

  const updateParallax = (scrollX: number, scrollY: number): void => {
    if (destroyed) return;
    for (const layer of layers) {
      const factor = layer.spec.parallaxFactor;
      if (layer.kind === 'texture') {
        const band = layer.gameObject as Phaser.GameObjects.TileSprite;
        const tileScale =
          layer.spec.textureTileScale ?? DEFAULT_TEXTURE_TILE_SCALE;
        // `tilePosition` is in *texture* pixels (pre-tileScale), so the
        // screen-space offset `scroll * factor` divides by the scale.
        // Positive tilePosition shifts the pattern left — the same
        // visual direction as moving a Graphics layer by `-offset`.
        band.tilePositionX = (scrollX * factor) / tileScale;
        band.y = layer.baseY - scrollY * factor;
      } else {
        const g = layer.gameObject as Phaser.GameObjects.Graphics;
        g.x = layer.baseX - scrollX * factor;
        g.y = layer.baseY - scrollY * factor;
      }
    }
  };

  const tick = (frame: number): void => {
    if (destroyed) return;
    ambient.setAlpha(computeAmbientPulseAlpha(theme.ambientPulse, frame));
  };

  const destroy = (): void => {
    if (destroyed) return;
    destroyed = true;
    gradient.destroy();
    ambient.destroy();
    for (const layer of layers) {
      layer.gameObject.destroy();
    }
  };

  return { theme, gradient, ambient, layers, updateParallax, tick, destroy };
}
